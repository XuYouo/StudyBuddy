// electron-builder 26.18 can match the '-' qualifier to a certificate whose
// name contains a hyphen. Explicitly select ad-hoc signing for local builds.
// Certificate builds keep electron-builder's normal signer.
const { createRequire } = require('node:module');
const builderRequire = createRequire(require.resolve('electron-builder'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));

exports.default = async function signLocalApp(options) {
  const { signAsync } = appBuilderRequire('@electron/osx-sign');
  await signAsync({ ...options, identity: '-', identityValidation: false, timestamp: 'none' });
};
