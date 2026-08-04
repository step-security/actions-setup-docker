[![StepSecurity Maintained Action](https://raw.githubusercontent.com/step-security/maintained-actions-assets/main/assets/maintained-action-banner.png)](https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions)

# setup-docker

Set up your GitHub Actions workflow with a specific version of Docker

Supports **Linux** and **macOS**

## Inputs

| Input | Description | Default | Required |
|---|---|---|---|
| `docker_version` | The Docker Engine version to install (e.g. `20.10`, `23.0`, `24.0`) | `24.0` | No |
| `docker_channel` | Release channel to use when fetching packages (`stable`, `test`) | `stable` | No |
| `docker_cli_experimental` | Enable experimental features in the Docker CLI (`enabled`) | `enabled` | No |
| `docker_daemon_json` | JSON content written to the Docker daemon configuration file | `{"experimental": true}` | No |
| `docker_buildx` | Set to `true` to install and configure Docker Buildx for multi-platform builds | `true` | No |
| `docker_nightly_version` | Snapshot tag for Docker nightly builds (only used when `docker_channel` is `nightly`) | `snapshot-20210202` | No |

## Usage

### Basic

```yaml
on:
  push:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: step-security/actions-setup-docker@v1
      - run: docker version
```

### With specific version and channel

```yaml
on:
  push:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: step-security/actions-setup-docker@v1
        with:
          docker_version: "24.0"
          docker_channel: stable
      - run: |
          docker version
          docker run --rm hello-world
```

### With Buildx for multi-platform builds

```yaml
on:
  push:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: step-security/actions-setup-docker@v1
        with:
          docker_buildx: "true"
      - run: |
          docker buildx version
          docker buildx ls
```
