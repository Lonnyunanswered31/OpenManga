import { Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { del, patch, post } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import type { CharacterOutfitRow } from "../../api/types.ts";

export function OutfitsEditor({
  characterId,
  versionId,
  outfits,
  onChanged,
}: {
  characterId: string;
  versionId: string | null;
  outfits: CharacterOutfitRow[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const opts = { onSuccess: onChanged };
  const add = useAction(
    () =>
      post(`/characters/${characterId}/outfits`, {
        name: name.trim(),
        description,
        isDefault: !outfits.length,
        characterVersionId: versionId,
      }),
    {
      onSuccess: () => {
        setName("");
        setDescription("");
        onChanged();
      },
    },
  );
  const update = useAction(
    ({ id, body }: { id: string; body: Partial<CharacterOutfitRow> }) => patch(`/character-outfits/${id}`, body),
    opts,
  );
  const remove = useAction((id: string) => del(`/character-outfits/${id}`), opts);
  return (
    <section className="card p-3">
      <h2 className="mb-2 text-sm font-semibold">Outfits</h2>
      <ul className="space-y-2">
        {outfits.map((o) => (
          <li key={o.id} className="rounded-lg border border-[var(--border)] p-2">
            <div className="flex items-center gap-1">
              <input
                className="input py-1 text-sm font-medium"
                defaultValue={o.name}
                aria-label="Outfit name"
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== o.name &&
                  update.mutate({ id: o.id, body: { name: e.target.value.trim() } })
                }
              />
              <button
                type="button"
                className="btn-ghost p-1"
                aria-label={o.isDefault ? "Default outfit" : "Make default"}
                title={o.isDefault ? "Default" : "Make default"}
                onClick={() => !o.isDefault && update.mutate({ id: o.id, body: { isDefault: true } })}
              >
                <Star className={`size-4 ${o.isDefault ? "fill-amber-400 text-amber-400" : ""}`} />
              </button>
              <button
                type="button"
                className="btn-ghost p-1 text-red-500"
                aria-label="Delete outfit"
                onClick={() => remove.mutate(o.id)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <textarea
              className="input mt-1 min-h-12 text-xs"
              defaultValue={o.description}
              aria-label="Outfit description"
              onBlur={(e) =>
                e.target.value !== o.description && update.mutate({ id: o.id, body: { description: e.target.value } })
              }
            />
          </li>
        ))}
      </ul>
      <form
        className="mt-2 space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <input
          className="input"
          placeholder="New outfit name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="New outfit name"
        />
        <textarea
          className="input min-h-12 text-xs"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="New outfit description"
        />
        <button type="submit" className="btn-secondary w-full" disabled={!name.trim() || add.isPending}>
          <Plus className="size-4" /> Add outfit
        </button>
      </form>
    </section>
  );
}
