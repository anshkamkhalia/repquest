const { withXcodeProject, withDangerousMod, IOSConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODEL_FILENAME = 'pose_landmarker_full.task';

// react-native-mediapipe ships no Expo config plugin of its own and only
// resolves its model file via Bundle.main.path(forResource:ofType:) on iOS
// and the assets/ folder on Android — both require the .task file (already
// at the repo root, same one the Python pipeline uses) to be registered as
// a native resource on every prebuild.
function withPoseLandmarkerModel(config) {
  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectRoot = config.modRequest.projectRoot;
    const platformProjectRoot = config.modRequest.platformProjectRoot;
    const modelPath = path.join(projectRoot, MODEL_FILENAME);
    const relativePath = path.relative(platformProjectRoot, modelPath);

    IOSConfig.XcodeUtils.ensureGroupRecursively(project, 'Resources');
    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: relativePath,
      groupName: 'Resources',
      project,
      isBuildFile: true,
      verbose: true,
    });

    return config;
  });

  config = withDangerousMod(config, [
    'android',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformProjectRoot = config.modRequest.platformProjectRoot;
      const assetsDir = path.join(platformProjectRoot, 'app/src/main/assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.copyFileSync(path.join(projectRoot, MODEL_FILENAME), path.join(assetsDir, MODEL_FILENAME));
      return config;
    },
  ]);

  return config;
}

module.exports = withPoseLandmarkerModel;
