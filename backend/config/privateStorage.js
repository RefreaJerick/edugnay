const os = require('os');
const path = require('path');

const workspaceDirectory = path.resolve(__dirname, '..', '..');

function getPrivateStorageDirectory(environmentName, defaultFolder) {
  const directory = path.resolve(process.env[environmentName]
    || path.join(os.homedir(), '.academix', 'uploads', defaultFolder));
  const relativePath = path.relative(workspaceDirectory, directory);
  if (directory === path.parse(directory).root || !relativePath || (!relativePath.startsWith(`..${path.sep}`)
    && relativePath !== '..' && !path.isAbsolute(relativePath))) {
    throw new Error(`${environmentName} must be outside the project workspace.`);
  }
  return directory;
}

module.exports = { getPrivateStorageDirectory };
