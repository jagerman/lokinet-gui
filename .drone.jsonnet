local docker_image = 'registry.oxen.rocks/lokinet-ci-nodejs-lts';

local apt_get_quiet = 'apt-get -o=Dpkg::Use-Pty=0 -q';

// Regular build on a debian-like system:
local deb_pipeline(image, buildarch='amd64', debarch='amd64') = {
  kind: 'pipeline',
  type: 'docker',
  name: 'deb (' + debarch + ')',
  platform: { arch: buildarch },
  steps: [
    {
      name: 'build',
      image: image,
      environment: {
        FORCE_COLOR: 'true',
        SSH_KEY: { from_secret: 'SSH_KEY' },
        USE_SYSTEM_FPM: if buildarch == 'arm64' then 'true' else null,
      },
      commands: [
        'echo "Building on ${DRONE_STAGE_MACHINE}"',
        'echo "man-db man-db/auto-update boolean false" | debconf-set-selections',
        apt_get_quiet + ' update',
        apt_get_quiet + ' install -y eatmydata',
        'eatmydata ' + apt_get_quiet + ' dist-upgrade -y',
        'yarn --version',
        'node --version',
        'mkdir -p $CCACHE_DIR/electron-builder',
        'mkdir -p $CCACHE_DIR/yarn',
        'yarn install --frozen-lockfile --cache-folder $CCACHE_DIR/yarn',
      ] + (if buildarch == 'arm64' then [
             apt_get_quiet + ' install -y ruby ruby-dev',
             'gem install fpm',
           ] else []) + [
        'ELECTRON_BUILDER_CACHE=$CCACHE_DIR/electron-builder yarn --cache-folder $CCACHE_DIR/yarn deb',
        './debian/ci-upload.sh sid ' + debarch,
      ],
    },
  ],
};

[
  deb_pipeline(docker_image),
  deb_pipeline(docker_image + '/arm64v8', buildarch='arm64', debarch='arm64'),
  deb_pipeline(docker_image + '/arm32v7', buildarch='arm64', debarch='armhf'),
]
