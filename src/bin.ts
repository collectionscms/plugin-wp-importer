#!/usr/bin/env node
import { Command } from "commander";
import fse from "fs-extra";
import { parseFromFile } from "./parsers/xml/index.js";

const program = new Command();

const runParse = async (options: { path: string }) => {
  const path = options.path.trim();
  try {
    const file = fse.readFileSync(path, "utf-8");
    const result = await parseFromFile(file);
    console.log(`✨ Success`, result);
  } catch (e) {
    console.log(`❌ Error`, e);
  }
};

program
  .command("parse:xml")
  .description("parse xml")
  .requiredOption("-p, --path <path>", "path option")
  .action(runParse);

program.parseAsync(process.argv);
