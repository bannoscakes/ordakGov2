import type { ActionFunctionArgs } from "@remix-run/node";
import { appProxyAction } from "../utils/app-proxy.server";
import { action as recommendationsSlotsAction } from "./api.recommendations.slots";

export async function action(args: ActionFunctionArgs) {
  return appProxyAction(args, recommendationsSlotsAction);
}
