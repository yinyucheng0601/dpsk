# DeepSeek V3 Flowchart MVP

这个目录是一个面向模型开发者的可交互可视化原型，用来按层查看 DeepSeek V3 decoder block 内部的主要算子结构，而不是从 token 生成视角解释模型。

## 可视化对象

当前 MVP 主要展示单个 decoder layer 的纵向 flowchart：

- `RMSNorm`
- `Attention`
- `Attention` 内部展开链路
  - `Q projection`
  - `KV projection`
  - `Q split`
  - `KV expand`
  - `KV split`
  - `RoPE + Q/K assemble`
  - `Scaled dot-product`
  - `Softmax`
  - `Weighted sum`
  - `O projection`
- `Feed-Forward` 或 `MoE Feed-Forward`
- `Feed-Forward` 内部展开链路
  - Dense: `Gate projection` -> `Up projection` -> `SwiGLU` -> `Down projection`
  - MoE: `Router logits` -> `Top-k router` -> `Dispatch` -> `Routed experts` / `Shared experts` -> `Combine`
- 两个残差汇合点
- 顶部 layer 翻页器

交互方式：

- 点击 `Attention` 或 `Feed-Forward` 右上角 `+/-` 展开或收起内部算子
- 点击顶部 `<` `>` 在 61 层之间翻页
- 拖拽平移
- `Ctrl` / `Cmd` + 滚轮缩放
- 双击空白处 `zoomToFit`

## 数据来源

前端数据来自 [data.js](/Users/yin/deepseek-v3/mvp/data.js)，它是由 [generate_interpretability_artifacts.py](/Users/yin/deepseek-v3/tools/generate_interpretability_artifacts.py) 生成的浏览器可直接加载版本。

原始抽取来源是本地 DeepSeek V3 源码，不是模型卡摘要，当前覆盖：

- [configuration_deepseek.py](/Users/yin/deepseek-v3/configuration_deepseek.py)
- [modeling_deepseek.py](/Users/yin/deepseek-v3/modeling_deepseek.py)
- [inference/model.py](/Users/yin/deepseek-v3/inference/model.py)
- [inference/kernel.py](/Users/yin/deepseek-v3/inference/kernel.py)
- [inference/generate.py](/Users/yin/deepseek-v3/inference/generate.py)

相关中间文档：

- [deepseek_v3_interpretability.json](/Users/yin/deepseek-v3/docs/deepseek_v3_interpretability.json)
- [deepseek_v3_interpretability.md](/Users/yin/deepseek-v3/docs/deepseek_v3_interpretability.md)

数据里保留了：

- 模型默认配置
- 61 层 layer 列表
- dense / MoE layer 划分
- operator 名称、所属 stage、权重名、shape、source ref

MVP 前端为了降低噪音，目前只消费其中一部分字段，界面只显示算子名称。

## JS 框架来源

图形交互使用 AntV X6，当前静态拷贝放在：

- [x6.min.js](/Users/yin/deepseek-v3/mvp/vendor/x6.min.js)

页面入口和样式：

- [index.html](/Users/yin/deepseek-v3/mvp/index.html)
- [styles.css](/Users/yin/deepseek-v3/mvp/styles.css)
- [app.js](/Users/yin/deepseek-v3/mvp/app.js)

选择 X6 的原因是它比纯 DOM/SVG 叠层方案更适合：

- 父子群组
- 节点折叠/展开
- 画布级缩放和平移
- 后续继续做 layer 内部算子下钻

## 这版做了什么优化

这一轮 MVP 重点不是“信息更全”，而是把交互结构先做稳：

- 从卡片式布局改成单一竖向 flowchart
- 去掉渐变、阴影和无关卡片，只保留主图
- 用一个常驻虚线外框表示当前 layer
- 把 `Attention` 和 `Feed-Forward` 改成可折叠父群组
- 把 layer 外框、标题条、翻页器、`RMSNorm`、残差线、`+` 节点统一纳入 group tree，避免展开/收起后残留元素
- 把展开方式改成原地纵向扩展，后续节点整体下移
- 大幅简化信息密度，界面只显示算子名称，不显示 shape、tag、fusion note
- 修复了展开后再收起时旧图元叠加的问题，改为更稳定的整图替换时序

## 当前限制

这仍然是 MVP，不是完整 interpretability 工作台。当前还没有：

- 权重矩阵热图
- 真实 tensor 运行时激活可视化
- 多层并排比较
- 从源码自动生成更细粒度的 fusion 子图
- 按 backend 区分 `HF eager` / `FlashAttention2` / kernel path 的视图切换

## 本地打开

最简单的方式是在这个目录起一个静态服务器，然后打开 `index.html`：

```bash
cd /Users/yin/deepseek-v3/mvp
python3 -m http.server 8765
```

然后访问：

```text
http://127.0.0.1:8765/
```
