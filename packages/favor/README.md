# YesImBot 扩展插件：好感度系统 (Favor System)

[![npm](https://img.shields.io/npm/v/koishi-plugin-yesimbot-extension-favor.svg)](https://www.npmjs.com/package/koishi-plugin-yesimbot-extension-favor)
[![koishi-version](https://img.shields.io/badge/koishi-^4.16-blue)](https://koishi.chat)
[![license](https://img.shields.io/badge/license-MIT-green)](https://github.com/your-repo/koishi-plugin-favor-system/blob/main/LICENSE)

一个为 [YesImBot](https://github.com/HydroGest/YesImBot) 设计的，用于管理与用户好感度的插件。它能够让 AI 感知并动态调整与用户的好感度，从而实现更加生动和沉浸式的角色扮演体验。

## ✨ 特性

-   **用户好感度追踪**：为每个用户独立记录好感度数值。
-   **自定义好感度阶段**：可自由配置不同好感度阈值对应的关系阶段描述。
-   **AI 工具集成**：提供 `add_favor` 和 `set_favor` 工具，允许 AI 在对话中根据情景自主调整好感度。
-   **动态提示词注入**：将当前的好感度数值 (`{{roleplay.favor}}`) 和关系阶段 (`{{roleplay.state}}`) 实时注入到 AI 的系统提示词中。

## 📦 安装

```bash
# 在你的 Koishi 项目根目录下执行
npm i koishi-plugin-yesimbot-extension-favor
```

或者通过 Koishi 的插件市场，搜索并安装 `yesimbot-extension-favor`。

## 🚀 使用指南

### 1. 启用并配置插件

### 2. 在 AI 系统提示词中集成好感度信息

这是本插件的核心功能。你需要编辑 YesImBot 的系统提示词（System Prompt），加入特定的占位符。

**示例系统提示词：**

> 你是我的专属猫娘助理，你的名字叫“Neko”。你需要时刻以 Neko 的身份与我对话，不能暴露自己是 AI。
>
> **【重要设定】**
> 这是你和我当前的关系信息，请在对话中时刻参考：
> - **好感度数值**: {{roleplay.favor}}
> - **当前关系阶段**: {{roleplay.state}}
>
> 请根据当前的好感度和关系阶段，以合适的语气和内容与我互动。当我的行为让你感到高兴或失落时，你可以调用工具来调整好感度。

当 AI 进行回复时，`{{roleplay.favor}}` 和 `{{roleplay.state}}` 会被自动替换为如下内容：

> **【重要设定】**
> 这是你和我当前的关系信息，请在对话中时刻参考：
> - **好感度数值**: 当前你与用户 YourName (ID: 12345) 的好感度为 65。
> - **当前关系阶段**: 当前你与用户 YourName (ID: 12345) 的关系阶段是：可以信赖的伙伴。

这样，AI 就能“感知”到它与用户的关系，并作出相应的回应。

### 3. AI 自动调整好感度

AI 可以通过调用插件提供的工具来改变好感度。例如，当用户说出让角色开心的话时，AI 可能会在内心思考（Inner Thought）后决定调用 `add_favor` 工具。

**AI 的内心活动（示例）:**
> *Inner thoughts: 用户夸我可爱，这让我非常开心，应该增加我们之间的好感度。我决定为他增加 5 点好感度。*
> *Tool call: `add_favor({ user_id: '12345', amount: 5 })`*

这个过程是自动发生的，使得角色扮演更加动态和真实。

## ⚙️ 配置项

| 配置项 | 类型 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `initialFavor` | `number` | `0` | 新用户的初始好感度。 |
| `maxFavor` | `number` | `100` | 好感度的最大值。任何操作都无法使好感度超过此值。 |
| `stage` | `[number, string][]` | 见代码 | 好感度阶段配置。一个由 `[阈值, 描述]` 组成的数组。系统会自动从高到低匹配，第一个满足 `当前好感度 >= 阈值` 的阶段将被采用。**这些描述将通过 `{{roleplay.state}}` 片段提供给 AI。** |

## 🤖 AI 可用工具 (Tools)

本插件向 AI 暴露了以下工具，AI 可以根据对话上下文自行调用。

-   **`add_favor(user_id: string, amount: number)`**
    -   **描述**: 为指定用户增加或减少好感度。最终好感度会被限制在 `[0, maxFavor]` 范围内。
    -   **参数**:
        -   `user_id`: 目标用户的 ID。
        -   `amount`: 要增加的好感度数量，负数则为减少。
-   **`set_favor(user_id: string, amount: number)`**
    -   **描述**: 为指定用户直接设置好感度。同样会被限制在 `[0, maxFavor]` 范围内。
    -   **参数**:
        -   `user_id`: 目标用户的 ID。
        -   `amount`: 要设置的目标好感度值。

## 📄 许可证

[MIT License](./LICENSE)