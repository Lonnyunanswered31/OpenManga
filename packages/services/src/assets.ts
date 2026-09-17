import type { AppConfig } from "@openmanga/config";
import { and, assets, assetVariants, type Database, type DbOrTx, desc, eq } from "@openmanga/db";
import {
  createPromptReference,
  createThumbnail,
  extForMime,
  type ReferenceParams,
  referenceCacheKey,
} from "@openmanga/image-utils";
import { type AssetStorage, newStorageKey, sha256File, sha256Hex } from "@openmanga/storage";

export type AssetType = (typeof assets.$inferInsert)["type"];
export type AssetRecord = typeof assets.$inferSelect;
export type VariantRecord = typeof assetVariants.$inferSelect;

export type StoreAssetInput = {
  projectId: string | null;
  ownerUserId: string | null;
  type: AssetType;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  status?: "draft" | "approved" | "locked" | "superseded";
  parentAssetId?: string | null;
  generationJobId?: string | null;
  metadata?: Record<string, unknown>;
  visibility?: "private" | "public";
  /** Import only: artwork versions are numbered by createdAt, so a restored history must keep its own timestamps. */
  createdAt?: Date;
} & ({ data: Uint8Array } | { filePath: string });

/** Image providers that price per image regardless of input size. */
export const FLAT_RATE_IMAGE_PROVIDERS = new Set(["meta"]);

export class AssetService {
  constructor(
    private readonly db: Database,
    readonly storage: AssetStorage,
    private readonly config: AppConfig,
  ) {}

  /**
   * Writes the file first, then the row (in the caller's tx if given). A crash between the two leaves an
   * orphan file that the maintenance job can remove; never a row pointing at a missing file.
   */
  async store(input: StoreAssetInput, tx: DbOrTx = this.db): Promise<AssetRecord> {
    const storageKey = newStorageKey(input.type, extForMime(input.mimeType));
    const stored =
      "data" in input
        ? await this.storage.put(storageKey, input.data)
        : await this.storage.putFile(storageKey, input.filePath);
    const sha256 = "data" in input ? sha256Hex(input.data) : await sha256File(input.filePath);
    const [row] = await tx
      .insert(assets)
      .values({
        projectId: input.projectId,
        ownerUserId: input.ownerUserId,
        type: input.type,
        visibility: input.visibility ?? "private",
        storageKey,
        mimeType: input.mimeType,
        width: input.width ?? null,
        height: input.height ?? null,
        durationMs: input.durationMs ?? null,
        byteSize: stored.byteSize,
        sha256,
        status: input.status ?? "draft",
        parentAssetId: input.parentAssetId ?? null,
        generationJobId: input.generationJobId ?? null,
        metadata: input.metadata ?? {},
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      })
      .returning();
    return row!;
  }

  read(asset: Pick<AssetRecord, "storageKey">) {
    return this.storage.read(asset.storageKey);
  }

  async get(id: string) {
    const [a] = await this.db.select().from(assets).where(eq(assets.id, id));
    return a ?? null;
  }

  /**
   * Reference derivative box. Token-billed providers get the small box (input tokens scale with pixels); flat-rate
   * providers (per-image pricing, no input billing) get a larger one because detail is free there.
   */
  referenceParams(overrides?: { maxWidth?: number; maxHeight?: number; provider?: string | null }): ReferenceParams {
    const flat = overrides?.provider ? FLAT_RATE_IMAGE_PROVIDERS.has(overrides.provider) : false;
    return {
      maxWidth:
        overrides?.maxWidth ?? (flat ? this.config.FLAT_RATE_REFERENCE_MAX_WIDTH : this.config.REFERENCE_MAX_WIDTH),
      maxHeight:
        overrides?.maxHeight ?? (flat ? this.config.FLAT_RATE_REFERENCE_MAX_HEIGHT : this.config.REFERENCE_MAX_HEIGHT),
      fit: this.config.REFERENCE_FIT,
      allowUpscale: this.config.REFERENCE_ALLOW_UPSCALE,
      format: this.config.REFERENCE_FORMAT,
      quality: this.config.REFERENCE_QUALITY,
    };
  }

  /** Cached small derivative for prompt references. Reproducible from the canonical asset; never the source of truth. */
  async ensurePromptReference(asset: AssetRecord, params: ReferenceParams): Promise<VariantRecord> {
    const cacheKey = referenceCacheKey(asset.sha256, params);
    const [existing] = await this.db.select().from(assetVariants).where(eq(assetVariants.cacheKey, cacheKey));
    if (existing && (await this.storage.exists(existing.storageKey))) {
      await this.db.update(assetVariants).set({ lastUsedAt: new Date() }).where(eq(assetVariants.id, existing.id));
      return existing;
    }
    const canonical = await this.read(asset);
    const d = await createPromptReference(canonical, params);
    const storageKey = newStorageKey("prompt_reference", extForMime(d.mime));
    await this.storage.put(storageKey, d.data);
    const values = {
      assetId: asset.id,
      variant: "prompt_ref" as const,
      cacheKey,
      storageKey,
      mimeType: d.mime,
      width: d.width,
      height: d.height,
      byteSize: d.data.byteLength,
      sha256: sha256Hex(d.data),
      params: { variant: "prompt_ref", sourceAssetId: asset.id, sourceSha256: asset.sha256, ...params },
      lastUsedAt: new Date(),
    };
    if (existing) {
      await this.storage.delete(existing.storageKey).catch(() => {});
      const [row] = await this.db
        .update(assetVariants)
        .set(values)
        .where(eq(assetVariants.id, existing.id))
        .returning();
      return row!;
    }
    const [row] = await this.db
      .insert(assetVariants)
      .values(values)
      .onConflictDoUpdate({ target: assetVariants.cacheKey, set: { storageKey, lastUsedAt: new Date() } })
      .returning();
    return row!;
  }

  async ensureThumbnail(asset: AssetRecord): Promise<VariantRecord | null> {
    return this.ensureResized(asset, "thumbnail", 384, 80);
  }

  /** Display-size copies: `preview` (1024px, editors/lists) and `web` (2048px, sharing/reading). Originals stay untouched. */
  static readonly SIZES = { thumbnail: 384, preview: 1024, web: 2048 } as const;

  async ensureResized(
    asset: AssetRecord,
    variant: "thumbnail" | "preview" | "web",
    maxSize: number = AssetService.SIZES[variant],
    quality = 85,
  ): Promise<VariantRecord | null> {
    if (!asset.mimeType.startsWith("image/")) return null;
    const cacheKey = sha256Hex(
      variant === "thumbnail"
        ? `${asset.sha256}:thumb:384:webp:q80`
        : `${asset.sha256}:${variant}:${maxSize}:webp:q${quality}`,
    );
    const [existing] = await this.db.select().from(assetVariants).where(eq(assetVariants.cacheKey, cacheKey));
    if (existing && (await this.storage.exists(existing.storageKey))) return existing;
    const t = await createThumbnail(await this.read(asset), maxSize, variant === "thumbnail" ? 80 : quality);
    const storageKey = newStorageKey(variant, "webp");
    await this.storage.put(storageKey, t.data);
    const [row] = await this.db
      .insert(assetVariants)
      .values({
        assetId: asset.id,
        variant,
        cacheKey,
        storageKey,
        mimeType: t.mime,
        width: t.width,
        height: t.height,
        byteSize: t.data.byteLength,
        sha256: sha256Hex(t.data),
        params: { variant, sourceAssetId: asset.id, maxSize },
      })
      .onConflictDoUpdate({ target: assetVariants.cacheKey, set: { storageKey } })
      .returning();
    return row!;
  }

  /**
   * Newest row of that kind. An asset can hold several of one kind — prompt references exist at both the
   * token-billed and flat-rate sizes — and an unordered pick returned an arbitrary one, which also made the
   * response's ETag disagree with the bytes it was serving.
   */
  async variantFor(assetId: string, variant: VariantRecord["variant"]) {
    const [v] = await this.db
      .select()
      .from(assetVariants)
      .where(and(eq(assetVariants.assetId, assetId), eq(assetVariants.variant, variant)))
      .orderBy(desc(assetVariants.createdAt), desc(assetVariants.id))
      .limit(1);
    return v ?? null;
  }

  async readVariant(v: VariantRecord) {
    return this.storage.read(v.storageKey);
  }

  /** Hard delete: removes file, variants and row. Callers must check it is not referenced as active content. */
  async hardDelete(asset: AssetRecord) {
    const vars = await this.db.select().from(assetVariants).where(eq(assetVariants.assetId, asset.id));
    await this.db.delete(assets).where(eq(assets.id, asset.id));
    for (const v of vars) await this.storage.delete(v.storageKey).catch(() => {});
    await this.storage.delete(asset.storageKey).catch(() => {});
  }
}
