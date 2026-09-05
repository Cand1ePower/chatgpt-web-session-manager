import React from "react";
import { ProductScene } from "./shared";

export const OverviewScene: React.FC = () => {
  return (
    <ProductScene
      kicker="01 / FIND THE THREAD"
      titleLines={["把历史对话", "变成可操作的卡片"]}
      description="分批浏览、快速定位，再把真正重要的内容留在眼前。"
      metric="8"
      metricLabel="synthetic conversations in this frame"
      chip="SYNTHETIC DEMO"
      image="demo/01-overview.png"
      imageAlt="ChatDeck overview showing synthetic conversation cards"
      accent="#d9f36c"
      sceneNumber="01"
    />
  );
};
