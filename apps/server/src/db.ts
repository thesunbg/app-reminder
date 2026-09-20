import { PrismaClient } from '@prisma/client'
import { isProd } from './env.js'

export const db = new PrismaClient({
  log: isProd ? ['warn', 'error'] : ['warn', 'error'],
})
