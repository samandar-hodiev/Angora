TalkingHead 1.7.0 by Mika Suominen (MIT, see LICENSE) — https://github.com/met4citizen/TalkingHead

Vendored rather than installed for one change: `lipsyncGetProcessor` imports its lip-sync
modules by a computed path, which Turbopack refuses to build. That `import()` is marked
`turbopackIgnore` here; the coach never uses it (it passes `lipsyncModules: []` and hands over
`LipsyncEn` itself). Everything else is the upstream file unchanged.
