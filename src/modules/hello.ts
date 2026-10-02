import type { Module } from "../core/types";
import { say } from "../core/result";

export const helloModule: Module = {
  name: "hello",
  commands: [
    {
      name: "hello",
      usage: "hello",
      about: "say hello (example module)",
      run: () => say("Hello! I am Anzu."),
    },
  ],
};
