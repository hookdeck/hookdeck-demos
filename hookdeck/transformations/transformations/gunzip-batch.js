// A gzip-compressed NDJSON batch arrives as bytes. The transformation
// decompresses it and hands the destination plain JSON it can read.
import { gunzipSync } from 'node:zlib';

export default {
  transform(request) {
    const ndjson = gunzipSync(request.body).toString('utf8');
    const events = ndjson.trim().split('\n').map((line) => JSON.parse(line));

    request.body = { count: events.length, events };
    request.headers['content-type'] = 'application/json';
    delete request.headers['content-encoding'];
    console.log(`Decompressed ${ndjson.length} bytes into ${events.length} events`);
    return request;
  },
};
