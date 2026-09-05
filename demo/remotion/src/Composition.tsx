import { Composition } from "remotion";
import { ChatDeckDemo } from "./ChatDeckDemo";

export const MyComposition = () => {
  return (
    <Composition
      id="ChatDeckDemo"
      component={ChatDeckDemo}
      durationInFrames={240}
      fps={30}
      width={1280}
      height={720}
    />
  );
};
