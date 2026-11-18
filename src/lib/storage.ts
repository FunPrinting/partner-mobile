/**
 * Small JSON documents in the app's document folder (settings, job state).
 * Secrets go to SecureStore instead (see session.ts).
 */
import { File, Paths } from 'expo-file-system';

export function readJson<T>(name: string, fallback: T): T {
  try {
    const file = new File(Paths.document, `${name}.json`);
    if (!file.exists) return fallback;
    return { ...fallback, ...JSON.parse(file.textSync()) };
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, value: unknown) {
  try {
    const file = new File(Paths.document, `${name}.json`);
    file.write(JSON.stringify(value));
  } catch (err) {
    console.warn(`Could not save ${name}:`, err);
  }
}

export function removeJson(name: string) {
  try {
    const file = new File(Paths.document, `${name}.json`);
    if (file.exists) file.delete();
  } catch {
    // already gone
  }
}
