import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { DetailScene } from "./scenes/DetailScene";
import { OverviewScene } from "./scenes/OverviewScene";
import { SelectionScene } from "./scenes/SelectionScene";

const transitionTiming = linearTiming({
  durationInFrames: 15,
  easing: Easing.inOut(Easing.cubic),
});

export const ChatDeckDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#111318" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={90} name="overview">
          <OverviewScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          timing={transitionTiming}
          presentation={wipe({ direction: "from-left" })}
        />
        <TransitionSeries.Sequence durationInFrames={90} name="selection">
          <SelectionScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          timing={transitionTiming}
          presentation={fade({ shouldFadeOutExitingScene: true })}
        />
        <TransitionSeries.Sequence durationInFrames={90} name="detail">
          <DetailScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
