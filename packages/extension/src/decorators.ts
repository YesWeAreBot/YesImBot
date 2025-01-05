export function Name(funcName: string) {
  return function (target: Function) {
    target["funcName"] = funcName;
  };
}

export function Description(description: string) {
  return function (target: Function) {
    target["description"] = description;
  };
}


export function Param(param: string, schema: string | SchemaNode) {
  return function (target: Function) {
    if (!target["params"]) {
      target["params"] = {};
    }
    if (typeof schema === "string") {
      schema = SchemaNode.String(schema);
    }
    target["params"][param] = schema;
  };
}
