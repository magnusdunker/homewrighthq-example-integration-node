// Programmets indgang: kør integrationen mod TheHome på stdin og stdout.
import { run } from '../sdk/thehome-plugin.js';
import { integration } from './counter.js';

run(integration);
