import { Request, Response, NextFunction } from "express";

export const authenticateApiKey = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const apiKey = req.header("X-API-Key");
  if (apiKey !== process.env.API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
  }
  next();
};
