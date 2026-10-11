# Heat Steward branding

The editable vector masters live in:

- `addon/frontend/src/assets/heat-steward-wordmark.svg` — pale shield, solid radiator H, and editable wordmark text
- `addon/frontend/src/assets/heat-steward-icon.svg` — single-colour cutout mark

The frontend uses these SVG files directly. The PNG files are exports for Home
Assistant and other consumers that require raster images:

- `addon/logo.png` — 250 × 100 wordmark
- `addon/icon.png` — 128 × 128 cutout icon

## Alignment

In the wordmark SVG, the shield and radiator H crossbar are centred at `x=70`.
The broad H uprights end at `y=112.5`, closely matching the wordmark baseline;
only the two narrow radiator feet extend below it. The lettering begins at
`x=119`, allowing the first `e` to overlap the pale shield without losing its
counter or merging into the shield edge.

The SVG groups and shapes have descriptive IDs so they can be selected directly
in Figma, Illustrator, Inkscape, or a text editor. After editing a master, export
fresh transparent PNGs at the dimensions above.
