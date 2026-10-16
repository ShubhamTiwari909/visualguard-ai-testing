import { operationsCommand } from "./operations-command.js";

void operationsCommand(process.argv.slice(2))
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Workspace operation failed");
    process.exitCode = 1;
  });
