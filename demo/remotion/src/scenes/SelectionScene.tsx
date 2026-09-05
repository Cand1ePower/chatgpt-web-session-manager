import React from "react";
import { ProductScene } from "./shared";

export const SelectionScene: React.FC = () => {
  return (
    <ProductScene
      kicker="02 / MAKE A SELECTION"
      titleLines={["看见状态，", "看见下一步。"]}
      description="选中的卡片保留清晰的视觉反馈，把焦点收缩到当前动作。"
      metric="5"
      metricLabel="cached locally · 3 ready to read"
      chip="NO ACCOUNT DATA"
      image="demo/02-selected.png"
      imageAlt="ChatDeck selection mode with all synthetic cards selected"
      accent="#6878ff"
      sceneNumber="02"
    />
  );
};
