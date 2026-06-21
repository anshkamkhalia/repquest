// react-native-vector-icons is a transitive dependency of react-native-mediapipe
// (used only by that library's own example app, not by the pose-detection API
// we actually import). Its codegen spec doesn't generate cleanly under RN
// 0.85's New Architecture, so it's excluded from native autolinking entirely.
module.exports = {
  dependencies: {
    'react-native-vector-icons': {
      platforms: {
        ios: null,
        android: null,
      },
    },
  },
};
