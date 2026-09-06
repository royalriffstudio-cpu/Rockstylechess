import { cssInterop } from 'nativewind';
import { KeyboardAwareScrollView as RNKAScrollView } from 'react-native-keyboard-controller';

// nativewind only rewrites `className`/`contentContainerClassName` into real
// styles for components it's registered -- it knows about RN's own
// ScrollView, but not this third-party replacement, so every screen using
// those props on it needs this mapping registered once, here.
cssInterop(RNKAScrollView, {
  className: 'style',
  contentContainerClassName: 'contentContainerStyle',
});

export { RNKAScrollView as KeyboardAwareScrollView };
