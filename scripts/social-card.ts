/**
 * Regenerates docs/images/social-preview.png (GitHub About -> Social preview, 1280x640).
 *
 * Rendered in a browser rather than with Sharp: the libvips build shipped with sharp has no text operation, so
 * both `sharp({ text })` and SVG `<text>` come out blank. Run it through the Playwright image, which already
 * exists for the e2e suite:
 *
 *   sg docker -c "docker run --rm -v \$PWD:/repo -w /repo openmanga-e2e:1 bun scripts/social-card.ts"
 */
import { chromium } from "@playwright/test";

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: "Comic Neue"; src: url("/repo/apps/web/public/fonts/ComicNeue-Bold.otf"); font-weight: 700; }
  * { margin: 0; box-sizing: border-box; }
  body { width: 1280px; height: 640px; background: #0f172a; display: flex; align-items: center;
         font-family: system-ui, "DejaVu Sans", sans-serif; overflow: hidden; }
  .left { width: 560px; padding: 0 0 0 76px; color: #93b4fd; }
  .left img { width: 96px; height: 96px; display: block; }
  h1 { font-family: "Comic Neue", system-ui, sans-serif; font-weight: 700; font-size: 76px; color: #f8fafc;
       margin: 26px 0 18px; letter-spacing: -0.5px; }
  p { font-size: 25px; line-height: 1.55; }
  .rule { width: 280px; height: 3px; background: #3b6cf6; border-radius: 2px; margin: 30px 0 18px; }
  .url { font-size: 20px; color: #64748b; }
  .shot { width: 660px; border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.45); }
</style>
<body>
  <div class="left">
    <img src="/repo/docs/images/logo.svg" alt="">
    <h1>OpenManga</h1>
    <p>Story in. Consistent illustrated pages out.<br>Self-hosted &middot; bring your own provider key<br>Comic, webtoon or narrated video</p>
    <div class="rule"></div>
    <div class="url">github.com/pr0h0/OpenManga</div>
  </div>
  <img class="shot" src="/repo/docs/images/chapter-pages.png" alt="">
</body>`;

const path = "/repo/docs/images/social-preview.png";
await Bun.write("/tmp/social-card.html", html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.goto("file:///tmp/social-card.html");
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path });
await browser.close();
console.log(`wrote ${path}`);
