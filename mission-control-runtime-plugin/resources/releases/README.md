# Release artifacts

Binary archives are intentionally not committed in this repository because the PR pipeline rejects binary diffs.

To build `mission-control-runtime-0.1.6.tgz` locally:

```bash
cd mission-control-runtime-plugin
npm pack --pack-destination resources/releases
```

Then install with:

```bash
openclaw plugins install ./resources/releases/mission-control-runtime-0.1.6.tgz
```
