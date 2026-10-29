import { hash } from '@node-rs/argon2';
import { pool, queryOne } from './pool.js';
import { config } from '../config.js';
import { SCREENS } from '../services/screens.js';
import { PERMISSION_LEAVES } from '../services/permissions.js';

async function seed(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@trilho.local').toLowerCase();
  const name = process.env.ADMIN_NAME ?? 'Administrador';
  const password = process.env.ADMIN_PASSWORD ?? 'admin-local-123';

  if (!process.env.ADMIN_PASSWORD && !config.isProduction) {
    console.warn('AVISO: ADMIN_PASSWORD ausente. Usando senha de desenvolvimento. Nao use em producao.');
  }

  const existingProfile = await queryOne<{ id: string }>(
    "SELECT id FROM profiles WHERE name = 'Administrador'",
  );

  let profileId: string;
  if (existingProfile) {
    profileId = existingProfile.id;
  } else {
    const profile = await queryOne<{ id: string }>(
      `INSERT INTO profiles (name, description, screens, permissions)
       VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING id`,
      [
        'Administrador',
        'Perfil com acesso a todas as telas',
        JSON.stringify(SCREENS),
        JSON.stringify(PERMISSION_LEAVES),
      ],
    );
    if (!profile) throw new Error('Falha ao criar perfil administrador');
    profileId = profile.id;
  }

  const passwordHash = await hash(password);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, profile_id, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (email)
     DO UPDATE SET name = EXCLUDED.name,
                   password_hash = EXCLUDED.password_hash,
                   profile_id = EXCLUDED.profile_id,
                   is_active = true`,
    [name, email, passwordHash, profileId],
  );

  console.log(`Seed: administrador pronto (${email}).`);
}

seed()
  .then(async () => pool.end())
  .catch(async (error) => {
    console.error('Falha no seed:', error);
    await pool.end();
    process.exit(1);
  });
