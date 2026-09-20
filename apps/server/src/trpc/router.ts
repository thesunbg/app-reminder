import { router } from './trpc.js'
import { assistantRouter } from './routers/assistant.js'
import { authRouter } from './routers/auth.js'
import { diaryRouter } from './routers/diary.js'
import { eventRouter } from './routers/event.js'
import { familyRouter } from './routers/family.js'
import { noteRouter } from './routers/note.js'
import { notifyRouter } from './routers/notify.js'
import { routineRouter } from './routers/routine.js'
import { statsRouter } from './routers/stats.js'
import { studyRouter } from './routers/study.js'

export const appRouter = router({
  assistant: assistantRouter,
  auth: authRouter,
  diary: diaryRouter,
  event: eventRouter,
  family: familyRouter,
  note: noteRouter,
  notify: notifyRouter,
  routine: routineRouter,
  stats: statsRouter,
  study: studyRouter,
})

export type AppRouter = typeof appRouter
