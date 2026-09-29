import * as readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("What is your name? ", (name: string) => {
  console.log(`Nice to meet you, ${name}`);
  rl.close();
});