   import type { Module } from "../core/types";

   export const helloModule: Module = {
     name: "hello",
     commands: [
       {
         name: "hello",
         usage: "hello",
         about: "say hello (example module)",
         run: () => {
           console.log("Hello! I am Anzu.");
         },
       },
     ],
   };