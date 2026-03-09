import { PrismaClient, UserRole, WorkflowStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seed de la base de données...');

  // 1. Organisation
  const org = await prisma.organization.upsert({
    where: { slug: 'cabinet-saint-michel' },
    update: {},
    create: {
      id: randomUUID(),
      name: 'Cabinet Saint-Michel',
      slug: 'cabinet-saint-michel',
      settings: {
        timezone: 'Europe/Paris',
        language: 'fr',
        sandboxMode: true,
      },
    },
  });

  console.log(`✅ Organisation créée : ${org.name}`);

  // 2. Users
  // Mot de passe hashé fictif (bcrypt de "password123")
  const fakeHash = '$2b$10$K4GmKMfWq5Y8p1QxJ0aP5e1234567890123456789012345678';

  const admin = await prisma.user.upsert({
    where: { email: 'admin@cabinet-saint-michel.fr' },
    update: {},
    create: {
      id: randomUUID(),
      email: 'admin@cabinet-saint-michel.fr',
      passwordHash: fakeHash,
      firstName: 'Sophie',
      lastName: 'Bernard',
      role: UserRole.ADMIN,
      organizationId: org.id,
    },
  });

  const member = await prisma.user.upsert({
    where: { email: 'marie@cabinet-saint-michel.fr' },
    update: {},
    create: {
      id: randomUUID(),
      email: 'marie@cabinet-saint-michel.fr',
      passwordHash: fakeHash,
      firstName: 'Marie',
      lastName: 'Lefevre',
      role: UserRole.MEMBER,
      organizationId: org.id,
    },
  });

  console.log(`✅ Users créés : ${admin.firstName} (admin), ${member.firstName} (member)`);

  // 3. Workflows depuis les templates JSON
  const templatesDir = path.join(__dirname, '..', 'workflows', 'templates');
  const templateFiles = fs.readdirSync(templatesDir).filter((f) => f.endsWith('.json'));

  for (const file of templateFiles) {
    const content = JSON.parse(fs.readFileSync(path.join(templatesDir, file), 'utf-8'));

    await prisma.workflow.upsert({
      where: { id: content.id },
      update: {},
      create: {
        id: content.id,
        name: content.name,
        description: content.description,
        version: content.version,
        status: WorkflowStatus.DRAFT,
        trigger: content.trigger,
        steps: content.steps,
        variables: content.variables,
        tags: content.tags,
        organizationId: org.id,
        createdById: admin.id,
      },
    });

    console.log(`✅ Workflow créé : ${content.name}`);
  }

  console.log('\n🎉 Seed terminé avec succès !');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Erreur lors du seed :', e);
    await prisma.$disconnect();
    process.exit(1);
  });
