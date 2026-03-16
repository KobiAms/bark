export { PingCommand } from './ping.js';
export { HelpCommand } from './help.js';
export { SwitchDriverCommand } from './driver.js';
export { RestartCommand } from './restart.js';
export { StopCommand } from './stop.js';
export { ClearCommand } from './clear.js';
export { ModelsCommand } from './models.js';
export { NewCommand, DeleteCommand, ListAgentsCommand, SetModelCommand } from './agents.js';

import { PingCommand } from './ping.js';
import { HelpCommand } from './help.js';
import { SwitchDriverCommand } from './driver.js';
import { RestartCommand } from './restart.js';
import { StopCommand } from './stop.js';
import { ClearCommand } from './clear.js';
import { ModelsCommand } from './models.js';
import { NewCommand, DeleteCommand, ListAgentsCommand } from './agents.js';

export const coreCommands = [
    new HelpCommand(),
    new PingCommand(),
    new SwitchDriverCommand(),
    new StopCommand(),
    new ClearCommand(),
    new NewCommand(),
    new DeleteCommand(),
    new ListAgentsCommand(),
    new RestartCommand(),
    new ModelsCommand(),
];
