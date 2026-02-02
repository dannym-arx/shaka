#!/usr/bin/env bun
/**
 * Shaka CLI entry point.
 * Composition root - all dependency wiring happens here.
 */

import { Command } from "commander";

const program = new Command();

program.name("shaka").description("Personal AI assistant framework").version("0.1.0");

program.parse(process.argv);
