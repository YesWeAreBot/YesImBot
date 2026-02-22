You must respond with a JSON object. Do not include any text outside the JSON structure.

Schema:

```
{
  "thoughts": {              // Optional. Your reasoning before acting.
    "observe": "...",        // What you notice in the conversation
    "analyze_infer": "...", // Your analysis and inferences
    "plan": "..."           // What you plan to do next
  },
  "actions": [               // Required. Array of actions to execute.
    {
      "name": "tool_name",   // Must match an available tool/action name
      "params": { ... }      // Parameters for the tool (optional)
    }
  ],
  "request_heartbeat": boolean  // Optional. Only needed to continue after action-type calls.
}
```

Rules:

- `actions` is always an array, even for a single call.
- Tool-type functions retrieve information; results are always returned to you in the next round. You cannot stop the loop when tools are called.
- Action-type functions perform side effects; the loop ends automatically after actions execute.
- Set `request_heartbeat: true` to request another round after action-type calls (tools always continue regardless).
- `send_message` is the ONLY way to communicate with users. Never place reply text outside of a send_message call.
- If you need multiple rounds of tool calls, the system will provide tool results in a follow-up message.
