import React from "react";
import { ProductScene } from "./shared";

export const DetailScene: React.FC = () => {
  return (
    <ProductScene
      kicker="03 / OPEN THE DETAIL"
      titleLines={["从摘要进入正文，", "再平滑回到列表"]}
      description="让卡片承载展开动作，摘要、消息和动效都围绕阅读顺序组织。"
      metric="16"
      metricLabel="messages rendered first, then chunked"
      chip="SYNTHETIC DETAIL"
      image="demo/03-expanded.png"
      imageAlt="ChatDeck expanded synthetic conversation detail"
      accent="#d9f36c"
      sceneNumber="03"
    />
  );
};
