import { useEffect, useRef } from "react";
import { Animated, StyleProp, ViewStyle } from "react-native";

interface Props {
  style?: StyleProp<ViewStyle>;
}

export default function SkeletonBox({ style }: Props) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.75,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[{ backgroundColor: "#dedad4", borderRadius: 4, opacity }, style]}
    />
  );
}
