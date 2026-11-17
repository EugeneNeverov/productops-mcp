// Preloaded with `node --import` in the e2e suite: any network attempt prints a marker to stderr and throws.
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';

const block = (what) => () => {
  process.stderr.write(`NETWORK_ATTEMPT ${what}\n`);
  throw new Error(`network access is not allowed (${what})`);
};
net.Socket.prototype.connect = block('net.Socket.connect');
net.connect = net.createConnection = block('net.connect');
tls.connect = block('tls.connect');
http.request = http.get = block('http.request');
https.request = https.get = block('https.request');
dns.lookup = dns.resolve = block('dns');
dns.promises.lookup = dns.promises.resolve = block('dns.promises');
globalThis.fetch = block('fetch');
