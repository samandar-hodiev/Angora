TalkingHead 1.7.0 by Mika Suominen (MIT, see LICENSE) — https://github.com/met4citizen/TalkingHead

Vendored rather than installed for one change: `lipsyncGetProcessor` imports its lip-sync
modules by a computed path, which Turbopack refuses to build. That `import()` is marked
`turbopackIgnore` here; the coach never uses it (it passes `lipsyncModules: []` and hands over
`LipsyncEn` itself). The GLTF loader also gets three's `MeshoptDecoder`, because the coach models in
`public/coach/` are compressed with gltf-transform (`webp`, `resize 2048`, `meshopt`) — 37 MB
to 3.6 MB for Emma. Everything else is the upstream file unchanged.
