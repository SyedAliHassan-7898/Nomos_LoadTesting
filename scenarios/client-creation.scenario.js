/**
 * Client creation scenario entrypoint.
 *
 * The implementation lives in client-creation.core.js so the public scenario
 * files stay small and each business flow can be imported independently.
 */
import { runClientCreationScenario as runCoreClientCreationScenario } from './client-creation.core.js';

export function runClientCreationScenario(vu, iter) {
  return runCoreClientCreationScenario(vu, iter);
}
