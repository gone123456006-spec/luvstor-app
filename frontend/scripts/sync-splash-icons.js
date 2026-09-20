/**
 * Sync Android splash logos + launcher icons from app.json assets
 * without a full expo prebuild (preserves local android/ patches).
 */
const path = require("path");
const fs = require("fs");
const {
  generateImageAsync,
  generateImageBackgroundAsync,
  compositeImagesAsync,
} = require("@expo/image-utils");

const root = path.join(__dirname, "..");
const resRoot = path.join(root, "android", "app", "src", "main", "res");

const SPLASH = path.join(root, "assets", "images", "spashscreen.png");
const ICON = path.join(root, "assets", "images", "app-icon.png");
const MONO = path.join(root, "assets", "images", "android-icon-monochrome.png");
const PURPLE = "#5A2FC7";
/** Match adaptive icon background so splash ↔ icon feel continuous. */
const SPLASH_BG = PURPLE;
const IMAGE_WIDTH = 220;

const SPLASH_DPI = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

const ICON_DPI = {
  "mipmap-mdpi": 1,
  "mipmap-hdpi": 1.5,
  "mipmap-xhdpi": 2,
  "mipmap-xxhdpi": 3,
  "mipmap-xxxhdpi": 4,
};

async function writeSplash() {
  for (const [dpi, mult] of Object.entries(SPLASH_DPI)) {
    const size = IMAGE_WIDTH * mult;
    const canvasSize = 288 * mult;
    const background = await generateImageBackgroundAsync({
      width: canvasSize,
      height: canvasSize,
      backgroundColor: SPLASH_BG,
      resizeMode: "cover",
    });
    const { source: foreground } = await generateImageAsync(
      { projectRoot: root, cacheType: "luvstor-splash" },
      { src: SPLASH, resizeMode: "contain", width: size, height: size },
    );
    const composed = await compositeImagesAsync({
      background,
      foreground,
      x: (canvasSize - size) / 2,
      y: (canvasSize - size) / 2,
    });
    const outDir = path.join(resRoot, `drawable-${dpi}`);
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, "splashscreen_logo.png");
    fs.writeFileSync(out, composed);
    console.log(`✔ splash ${dpi} ${canvasSize}px`);
  }
}

async function genIcon(src, scale, { adaptive, bg, radius }) {
  const base = adaptive ? 108 : 48;
  const px = base * scale;
  const { source } = await generateImageAsync(
    { projectRoot: root, cacheType: adaptive ? "luvstor-adaptive" : "luvstor-legacy" },
    {
      src,
      width: px,
      height: px,
      resizeMode: "cover",
      backgroundColor: bg,
      borderRadius: radius ? px * radius : undefined,
    },
  );
  return source;
}

async function writeIcons() {
  for (const [folder, scale] of Object.entries(ICON_DPI)) {
    const outDir = path.join(resRoot, folder);
    fs.mkdirSync(outDir, { recursive: true });

    const legacy = await genIcon(ICON, scale, {
      adaptive: false,
      bg: PURPLE,
      radius: 0.2,
    });
    const legacyRound = await genIcon(ICON, scale, {
      adaptive: false,
      bg: PURPLE,
      radius: 0.5,
    });
    const foreground = await genIcon(ICON, scale, {
      adaptive: true,
      bg: PURPLE,
      radius: undefined,
    });
    const monoSrc = fs.existsSync(MONO) ? MONO : ICON;
    const mono = await genIcon(monoSrc, scale, {
      adaptive: true,
      bg: "transparent",
      radius: undefined,
    });

    fs.writeFileSync(path.join(outDir, "ic_launcher.webp"), legacy);
    fs.writeFileSync(path.join(outDir, "ic_launcher_round.webp"), legacyRound);
    fs.writeFileSync(path.join(outDir, "ic_launcher_foreground.webp"), foreground);
    fs.writeFileSync(path.join(outDir, "ic_launcher_monochrome.webp"), mono);
    console.log(`✔ icons ${folder}`);
  }
}

async function main() {
  if (!fs.existsSync(SPLASH)) throw new Error(`Missing ${SPLASH}`);
  if (!fs.existsSync(ICON)) throw new Error(`Missing ${ICON}`);
  if (!fs.existsSync(resRoot)) {
    console.warn("android/ res missing — skip native sync (run expo prebuild later)");
    return;
  }

  // Adaptive icons reference @color/iconBackground — must exist or AAPT fails
  const colorsPath = path.join(resRoot, "values", "colors.xml");
  fs.mkdirSync(path.dirname(colorsPath), { recursive: true });
  fs.writeFileSync(
    colorsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<resources>
  <color name="splashscreen_background">${SPLASH_BG}</color>
  <color name="iconBackground">${PURPLE}</color>
</resources>
`,
  );
  console.log("✔ colors.xml (splash + iconBackground)");

  await writeSplash();
  await writeIcons();
  console.log("\nDone. Rebuild the APK to see splash + icon on device.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
