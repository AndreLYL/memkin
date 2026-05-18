#!/usr/bin/env bun
import { Command } from "commander";

const program = new Command();

program
  .name("dbe")
  .description("Extract structured signals from communication platforms and AI agent sessions")
  .version("0.1.0");

program
  .command("extract")
  .description("Extract signals from a platform or source")
  .option("-c, --config <path>", "Path to config file (default: dbe.yaml)")
  .action((options) => {
    console.log("not implemented yet");
  });

program
  .command("doctor")
  .description("Diagnose configuration and connectivity")
  .option("-c, --config <path>", "Path to config file (default: dbe.yaml)")
  .action((options) => {
    console.log("not implemented yet");
  });

program.parse(process.argv);
