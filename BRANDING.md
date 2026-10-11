# Heat Steward branding

The editable vector master lives at:

- `addon/frontend/src/assets/heat-steward-icon.svg` — single-colour cutout mark

The frontend uses the SVG directly. The PNG files are exports for Home
Assistant and other consumers that require raster images:

- `addon/logo.png` — 250 × 100 centred cutout mark
- `addon/icon.png` — 128 × 128 cutout icon
- `addon/frontend/src/assets/heat-steward-icon.png` — 128 × 128 cutout icon

The shield and radiator H crossbar are centred at `x=70`. The SVG paths have
descriptive IDs so they can be selected directly in Figma, Illustrator,
Inkscape, or a text editor. After editing the master, export fresh transparent
PNGs at the dimensions above.
