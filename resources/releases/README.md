# Release artifacts

Binary archives are intentionally not committed in this repository because the PR pipeline rejects binary diffs.

To build `mission-control-runtime-0.1.6.tgz` locally:

```bash
cd resources/originating/mission-control-runtime-0.1.5
tar -czf ../../releases/mission-control-runtime-0.1.6.tgz package
```

Then install with:

```bash
openclaw plugins install ./resources/releases/mission-control-runtime-0.1.6.tgz
```
