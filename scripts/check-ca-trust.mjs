import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';

// Node's HTTPS clients and Git's system TLS store must both distrust this root.
const systemCertificates = readFileSync('/etc/ssl/certs/ca-certificates.crt', 'utf8').match(
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
);
if (!systemCertificates?.length) throw new Error('System CA bundle is empty');
for (const pem of [...rootCertificates, ...systemCertificates]) {
  if (new X509Certificate(pem).subject.split('\n').includes('CN=emSign ECC Root CA - G3')) {
    throw new Error('Compromised eMudhra hierarchy is still trusted');
  }
}
console.log('Node and system CA bundles distrust emSign ECC Root CA - G3');
