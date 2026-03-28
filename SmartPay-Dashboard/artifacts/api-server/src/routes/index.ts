import { Router, type IRouter } from "express";
import healthRouter from "./health";
import transactionsRouter from "./transactions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(transactionsRouter);

export default router;
