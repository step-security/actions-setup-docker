const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { exec: spawnShell } = require('child_process');

const dockerVersion = core.getInput('docker_version');
const dockerChannel = core.getInput('docker_channel');
const cliExperimental = core.getInput('docker_cli_experimental');
const daemonConfig = core.getInput('docker_daemon_json');
const enableBuildx = core.getInput('docker_buildx');
const nightlyVersion = core.getInput('docker_nightly_version');

async function runShell(command) {
  return new Promise((resolve, reject) => {
    spawnShell(command, (err, stdout, stderr) => {
      if (err) return reject(err);
      if (stderr) return reject(stderr);
      resolve(stdout.trim());
    });
  });
}

async function checkSubscription() {
  let isPrivate;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    isPrivate = eventData?.repository?.private;
  }

  const upstreamAction = 'docker-practice/actions-setup-docker';
  const currentAction = process.env.GITHUB_ACTION_REPOSITORY;
  const docsLink = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions';

  core.info('');
  core.info('[1;36mStepSecurity Maintained Action[0m');
  core.info(`Secure drop-in replacement for ${upstreamAction}`);
  if (isPrivate === false) core.info('[32m✓ Free for public repositories[0m');
  core.info(`[36mLearn more:[0m ${docsLink}`);
  core.info('');

  if (isPrivate === false) return;

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const requestPayload = { action: currentAction || '' };
  if (serverUrl !== 'https://github.com') requestPayload.ghes_server = serverUrl;

  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      requestPayload,
      { timeout: 3000 }
    );
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      core.error('[1;31mThis action requires a StepSecurity subscription for private repositories.[0m');
      core.error(`[31mLearn how to enable a subscription: ${docsLink}[0m`);
      process.exit(1);
    }
    core.info('Timeout or API not reachable. Continuing to next step.');
  }
}

async function installQemu() {
  core.startGroup('setup qemu');
  await exec.exec('docker', [
    'run', '--rm', '--privileged',
    'ghcr.io/dpsigs/tonistiigi-binfmt:latest',
    '--install', 'all'
  ]);
  core.endGroup();
}

async function listBinfmtMisc() {
  core.startGroup('list /proc/sys/fs/binfmt_misc');
  await exec.exec('ls -la', ['/proc/sys/fs/binfmt_misc']).catch(() => {});
  core.endGroup();
}

async function createBuilderInstance() {
  core.startGroup('create buildx instance');
  await exec.exec('docker', [
    'buildx', 'create',
    '--use',
    '--name', 'mybuilder',
    '--driver', 'docker-container',
    '--driver-opt', 'image=ghcr.io/dpsigs/moby-buildkit:master'
  ]);
  core.endGroup();
}

async function inspectBuilderInstance() {
  core.startGroup('inspect buildx instance');
  await exec.exec('docker', ['buildx', 'inspect', '--bootstrap']);
  core.endGroup();
}

async function setupBuildx() {
  core.debug('set DOCKER_CLI_EXPERIMENTAL');
  if (cliExperimental === 'enabled') {
    core.exportVariable('DOCKER_CLI_EXPERIMENTAL', 'enabled');
  }

  if (enableBuildx !== 'true') {
    core.info('buildx disabled');
    return;
  }

  core.exportVariable('DOCKER_CLI_EXPERIMENTAL', 'enabled');

  await exec.exec('docker', ['buildx', 'version']).then(async () => {
    await installQemu();
    await listBinfmtMisc();
    await createBuilderInstance();
    await inspectBuilderInstance();
  }, () => {
    core.info('this docker version NOT Support Buildx');
  });
}

async function installDockerMacOS() {
  core.startGroup('install docker');
  await exec.exec('wget', [
    'https://raw.githubusercontent.com/Homebrew/homebrew-cask/fe866ec0765de141599745f03e215452db7f511b/Casks/docker.rb'
  ]);
  await exec.exec('brew', ['install', '--cask', 'docker.rb']);
  core.endGroup();
}

async function startDockerMacOS() {
  core.startGroup('start docker step1');
  await exec.exec('sudo', [
    '/Applications/Docker.app/Contents/MacOS/Docker',
    '--unattended',
    '--install-privileged-components'
  ]);
  core.endGroup();

  core.startGroup('start docker step2');
  await exec.exec('open', [
    '-a', '/Applications/Docker.app',
    '--args', '--unattended', '--accept-license'
  ]);
  core.endGroup();
}

async function waitForDockerReady() {
  core.startGroup('wait docker running');
  await exec.exec('sudo', [
    'bash', '-c',
    `
set -x
command -v docker || echo 'test docker command 1: not found'
i=0
while ! /Applications/Docker.app/Contents/Resources/bin/docker system info &>/dev/null; do
(( i++ == 0 )) && printf %s '-- Waiting for Docker to finish starting up...' || printf '.'
command -v docker || echo 'test docker command loop: not found'
sleep 1
# wait 180s(3min)
if [ $i -gt 180 ];then exit 1;sudo /Applications/Docker.app/Contents/MacOS/com.docker.diagnose check;uname -a;system_profiler SPHardwareDataType;echo "::error::-- Wait docker start $i s too long, exit"; exit 1; fi
done
echo "::notice::-- Docker is ready.Wait time is $i s"
uname -a || true
system_profiler SPHardwareDataType || true
`
  ]);
  core.endGroup();
}

async function setupMacOS() {
  core.exportVariable('DOCKER_CONFIG', '/Users/runner/.docker');

  await exec.exec('docker', ['--version']).catch(() => {});
  await exec.exec('docker-compose', ['--version']).catch(() => {});

  await installDockerMacOS();

  await exec.exec('mkdir', ['-p', '/Users/runner/.docker']);
  fs.writeFileSync('/Users/runner/.docker/daemon.json', daemonConfig);

  core.startGroup('show daemon json content');
  await exec.exec('cat', ['/Users/runner/.docker/daemon.json']);
  core.endGroup();

  await startDockerMacOS();
  await waitForDockerReady();

  core.startGroup('docker version');
  await exec.exec('docker', ['version']);
  core.endGroup();

  core.startGroup('docker info');
  await exec.exec('docker', ['info']);
  core.endGroup();

  await core.group('set up buildx', setupBuildx);
}

async function addDockerAptKey() {
  core.debug('add apt-key');
  await runShell(`
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor | sudo sh -c 'cat >/usr/share/keyrings/docker-archive-keyring.gpg'
  `);
}

async function addDockerAptSource(ubuntuCodename) {
  const groupName = 'add apt source';
  core.debug(groupName);
  core.startGroup(groupName);
  const sourceEntry = `deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu ${ubuntuCodename} ${dockerChannel}\n`;
  const tmpPath = '/tmp/docker.list';
  fs.writeFileSync(tmpPath, sourceEntry);
  await exec.exec('sudo', ['cp', tmpPath, '/etc/apt/sources.list.d/docker.list']);
  core.endGroup();
}

async function updateAptCache() {
  const groupName = 'update apt cache';
  core.debug(groupName);
  core.startGroup(groupName);
  await exec.exec('sudo', ['apt-get', 'update']).catch(() => {});
  core.endGroup();
}

async function showAvailableDockerVersions() {
  const groupName = 'show available docker version';
  core.debug(groupName);
  core.startGroup(groupName);
  await exec.exec('apt-cache', [
    'madison', 'docker-ce', '|', 'grep', `${dockerVersion}`
  ]);
  core.endGroup();
}

async function resolveDockerVersionString() {
  let madisonOutput = '';
  await exec.exec('apt-cache', ['madison', 'docker-ce'], {
    listeners: { stdout: (data) => { madisonOutput += data.toString(); } },
    silent: true
  });

  const match = madisonOutput.split('\n').find(line => line.includes(dockerVersion));
  if (!match) {
    const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
    const versionIdLine = osRelease.split('\n').find(l => l.startsWith('VERSION_ID'));
    const osVersion = versionIdLine ? versionIdLine.split('=')[1].replace(/"/g, '') : 'unknown';
    core.warning(`Docker ${dockerVersion} not available on ubuntu ${osVersion}, will install latest docker version`);
    return '';
  }

  return match.split('|')[1]?.trim() || '';
}

async function removeDefaultMoby() {
  core.startGroup('remove default moby');
  await exec.exec('sudo', [
    'sh', '-c',
    'apt remove -y moby-buildx moby-cli moby-compose moby-containerd moby-engine moby-runc'
  ]).catch(() => {});
  core.endGroup();
}

async function installDockerPackages(versionString) {
  const groupName = 'install docker';
  core.debug(groupName);
  core.startGroup(groupName);

  await exec.exec('sudo', [
    'apt-get', '-y', '--allow-downgrades', 'install',
    versionString ? `docker-ce=${versionString}` : 'docker-ce',
    versionString ? `docker-ce-cli=${versionString}` : 'docker-ce-cli'
  ]);

  await exec.exec('sudo', [
    'apt-get', '-y', 'install', 'docker-compose-plugin'
  ]).catch(() => {});

  core.endGroup();
}

async function configureDaemonJson() {
  core.debug('set /etc/docker/daemon.json');
  core.startGroup('show default daemon json content_');
  core.endGroup();

  await exec.exec('sudo', ['tee', '/etc/docker/daemon.json'], {
    input: Buffer.from(daemonConfig)
  });

  core.startGroup('show daemon json content');
  await exec.exec('sudo', ['cat', '/etc/docker/daemon.json']);
  core.endGroup();
}

async function setupLinux() {
  let groupLabel;

  groupLabel = 'check docker systemd status';
  core.startGroup(groupLabel);
  await exec.exec('sudo', ['systemctl', 'status', 'docker']).then(() => {}).catch(() => {});
  core.endGroup();

  groupLabel = 'check docker version';
  core.debug(groupLabel);
  core.startGroup(groupLabel);
  await exec.exec('docker', ['version']).catch(() => {});
  core.endGroup();

  core.exportVariable('DOCKER_CONFIG', '/home/runner/.docker');

  await addDockerAptKey();

  const ubuntuCodename = await runShell('lsb_release -cs');
  await addDockerAptSource(ubuntuCodename);
  await updateAptCache();
  await showAvailableDockerVersions();

  const versionString = await resolveDockerVersionString();
  await removeDefaultMoby();
  await installDockerPackages(versionString);

  groupLabel = 'check docker version';
  core.debug(groupLabel);
  core.startGroup(groupLabel);
  await exec.exec('docker', ['version']);
  core.endGroup();

  groupLabel = 'check docker systemd status';
  core.debug(groupLabel);
  core.startGroup(groupLabel);
  await exec.exec('sudo', ['systemctl', 'status', 'docker']);
  core.endGroup();

  await configureDaemonJson();

  await exec.exec('sudo', ['systemctl', 'restart', 'docker']);

  await core.group('set up buildx', setupBuildx);

  core.startGroup('docker info');
  await exec.exec('docker', ['info']);
  core.endGroup();
}

async function main() {
  await checkSubscription();

  const platform = os.platform();

  if (platform === 'win32') {
    core.debug('check platform');
    await exec.exec('echo', [
      `::error::Only Support Linux and macOS platform, this platform is ${os.platform()}`
    ]);
    return;
  }

  if (platform === 'darwin') {
    await setupMacOS();
    return;
  }

  await setupLinux();
}

main().then(() => {
  console.log('Run success');
}).catch((err) => {
  core.setFailed(err.toString());
});
