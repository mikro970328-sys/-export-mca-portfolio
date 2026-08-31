import { fail } from './_lib.js';

export default async function handler(req, res) {
  return fail(res, 410, 'Endpoint retirado');
}
