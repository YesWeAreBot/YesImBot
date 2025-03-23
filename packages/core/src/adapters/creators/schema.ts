export interface ToolSchema {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: ParameterSchema;
    };
}

export interface ParameterSchema {
    type: "object";
    properties: {
        [key: string]: {
            type: string;
            description: string;
        };
    };
    required: string[];
}

// 基础类型定义
export interface SchemaNode {
    type: string;
    description: string;
    default?: any;
}

// 增强类型定义
export interface StringSchemaNode extends SchemaNode {
    type: "string";
}

export interface IntegerSchemaNode extends SchemaNode {
    type: "integer";
}

export interface ArraySchemaNode<T extends SchemaNode = SchemaNode> extends SchemaNode {
    type: "array";
    items: T;
}

export interface BooleanSchemaNode extends SchemaNode {
    type: "boolean";
}

export interface EnumSchemaNode extends SchemaNode {
    type: "enum";
    values: readonly string[];
}

export interface UnionSchemaNode extends SchemaNode {
    type: "union";
    values: readonly string[];
}

// 优化工厂函数
export namespace SchemaNode {
    export function String(desc: string, defaultValue?: string): StringSchemaNode {
        return {
            type: "string",
            description: desc,
            default: defaultValue,
        };
    }

    export function Integer(desc: string, defaultValue?: number): IntegerSchemaNode {
        return {
            type: "integer",
            description: desc,
            default: defaultValue,
        };
    }

    export function Array<T extends SchemaNode>(desc: string, items: T): ArraySchemaNode<T> {
        return {
            type: "array",
            description: desc,
            items,
        };
    }

    export function Boolean(desc: string, defaultValue?: boolean): BooleanSchemaNode {
        return {
            type: "boolean",
            description: desc,
            default: defaultValue,
        };
    }

    export function Enum(desc: string, values: readonly string[], defaultValue?: string): EnumSchemaNode {
        return {
            type: "enum",
            values,
            description: desc,
            default: defaultValue,
        };
    }

    export function Union(desc: string, values: readonly string[], defaultValue?: string): UnionSchemaNode {
        return {
            type: "union",
            values,
            description: desc,
            default: defaultValue,
        };
    }
}

export function getOutputSchema(format: "JSON" | "XML") {
    return `You should generate output in ${format} observing the schema provided. Strictly follow these ${format} requirements:

- All elements MUST be properly nested and closed
- Do not include any subelements in <reply> and <finalReply>
- The string in <reply> and <finalReply> must be unescaped and not contain any HTML tags
- Enum values must be exact matches to schema values

Schema:
status
  type: enum
  values: [success, skip, interaction]
  description: Response status. success for sending a message, skip for skipping the message, interaction for waiting for the return value from a function. If the function has no return value, or the function can't run when the status is function, set the status to success or skip. In other words, you can also run functions if the status is success or skip.
replyTo
  type: string
  description: Channel/User ID for reply. If you want to send a private message to the user, must prefix with 'private:' followed by the user ID.
nextReplyIn
  type: integer
  description: Messages before next reply.
logic
  type: string
  description: Response logic explanation.
reply
  type: string
  description: Initial response draft.
check
  type: string
  description: A description of the checks performed to ensure the initial reply complies with the rules specified in the '消息生成条例'.
finalReply
  type: string
  description: Final response after checks. The response will be sent to the channel or user based on the replyTo field.
functions
  type: array
  description: Functions to execute. You must set status to interaction to get the return value of functions. You can also run functions when the status is skip or success, depending on your needs. If you use the interaction tag, only fill in the status, logic and functions field, don't fill in the other fields.
`;
}

export function getFunctionSchema(format: "JSON" | "XML") {
    let example = "";
    if (format === "JSON") {
        example = `[{"name": "FUNCTION_NAME", "params": {"PARAM_NAME": "value1", "PARAM_NAME": "value2"}}, {"name": "function2", "params": {"param1": "value1"}}]`;
    } else if (format === "XML") {
        example = `<functions>
  <function>
    <name>FUNCTION_NAME</name>
    <params>
      <PARAM_NAME>value1</PARAM_NAME>
    </params>
  </function>
</functions>`;
    }

    return `Please select the most suitable function and parameters from the list of available functions below, based on the ongoing conversation. You can run multiple functions in a single response.
Provide your response in ${format} format and add it to the functions array in your output: ${example}.
Replace FUNCTION_NAME with the name of the function and PARAM_NAME with the name of the parameter.
Available functions:\n`;
}
