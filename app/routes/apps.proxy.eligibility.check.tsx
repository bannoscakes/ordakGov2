import type { ActionFunctionArgs } from "@remix-run/node";
import { appProxyAction } from "../utils/app-proxy.server";
import { action as eligibilityAction } from "./api.eligibility.check";

export async function action(args: ActionFunctionArgs) {
  return appProxyAction(args, eligibilityAction);
}
