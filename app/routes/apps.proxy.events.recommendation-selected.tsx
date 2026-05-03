import type { ActionFunctionArgs } from "@remix-run/node";
import { appProxyAction } from "../utils/app-proxy.server";
import { action as recommendationSelectedAction } from "./api.events.recommendation-selected";

export async function action(args: ActionFunctionArgs) {
  return appProxyAction(args, recommendationSelectedAction);
}
