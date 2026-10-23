import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Database } from './db.js';
import { HttpError } from './errors.js';

interface RepositoryIdentity {
  id: string;
  user_id: string;
  repository: string | null;
}
export interface RepositoryCredential {
  token: string;
  username?: string;
}

export function credentialStore(db: Database, encryptionKey?: string) {
  const key = encryptionKey ? Buffer.from(encryptionKey, 'hex') : undefined;
  const aad = (source: RepositoryIdentity) =>
    Buffer.from(JSON.stringify([source.id, String(source.user_id), source.repository]));
  const requireKey = () => {
    if (!key || key.length !== 32) throw new HttpError(503, '服务器尚未配置凭据加密密钥');
    return key;
  };
  return {
    available: key?.length === 32,
    async save(source: RepositoryIdentity, credential: RepositoryCredential) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', requireKey(), nonce);
      cipher.setAAD(aad(source));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(credential), 'utf8'),
        cipher.final(),
      ]);
      const encrypted = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext]);
      await db.query(
        'INSERT INTO repository_credentials (source_id,encrypted) VALUES ($1,$2) ON CONFLICT (source_id) DO UPDATE SET encrypted=excluded.encrypted,updated_at=now()',
        [source.id, encrypted],
      );
    },
    async read(source: RepositoryIdentity): Promise<RepositoryCredential | undefined> {
      const { rows } = await db.query<{ encrypted: Buffer }>(
        'SELECT encrypted FROM repository_credentials WHERE source_id=$1',
        [source.id],
      );
      if (!rows[0]) return undefined;
      const secret = requireKey();
      try {
        const encrypted = Buffer.from(rows[0].encrypted);
        if (encrypted.length < 30 || encrypted[0] !== 1) throw new Error('Invalid envelope');
        const decipher = createDecipheriv('aes-256-gcm', secret, encrypted.subarray(1, 13));
        decipher.setAAD(aad(source));
        decipher.setAuthTag(encrypted.subarray(13, 29));
        return JSON.parse(
          Buffer.concat([decipher.update(encrypted.subarray(29)), decipher.final()]).toString(
            'utf8',
          ),
        );
      } catch {
        throw new HttpError(503, '保存的仓库凭据无法解密，请重新保存凭据或联系管理员检查加密密钥');
      }
    },
    async remove(id: string) {
      await db.query('DELETE FROM repository_credentials WHERE source_id=$1', [id]);
    },
  };
}
